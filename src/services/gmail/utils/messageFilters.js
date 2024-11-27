import { logger } from '../../../utils/logger.js';

/**
 * Check if a message should be processed
 * @param {Object} messageData Message data including headers and metadata
 * @param {string} ourEmail Our email address
 * @returns {Object} Result with shouldProcess flag and reason
 */
export function shouldProcessMessage(messageData, ourEmail) {
  const headers = messageData.payload?.headers || [];
  const from = headers.find(h => h.name.toLowerCase() === 'from')?.value || '';
  const to = headers.find(h => h.name.toLowerCase() === 'to')?.value || '';
  
  // Skip messages without proper headers
  if (!from || !headers.find(h => h.name.toLowerCase() === 'subject')) {
    logger.debug('Skipping message without required headers', {
      messageId: messageData.id,
      hasFrom: !!from,
      timestamp: new Date().toISOString()
    });
    return {
      shouldProcess: false,
      reason: 'MISSING_HEADERS'
    };
  }

  // Skip outgoing messages (from us)
  if (from.includes(ourEmail)) {
    logger.debug('Skipping outgoing message', {
      from,
      to,
      messageId: messageData.id,
      timestamp: new Date().toISOString()
    });
    return {
      shouldProcess: false,
      reason: 'OUTGOING_MESSAGE'
    };
  }

  // Skip messages not addressed to us
  if (!to.includes(ourEmail)) {
    logger.debug('Skipping message not addressed to us', {
      from,
      to,
      messageId: messageData.id,
      timestamp: new Date().toISOString()
    });
    return {
      shouldProcess: false,
      reason: 'NOT_RECIPIENT'
    };
  }

  return {
    shouldProcess: true,
    reason: 'VALID_INCOMING_MESSAGE'
  };
}

/**
 * Track processed messages with thread context
 */
export class ProcessedMessageTracker {
  constructor() {
    this.processed = new Set();
    this.threadLocks = new Set();
  }

  /**
   * Check if message was processed
   * @param {string} threadId Thread ID
   * @param {string} messageId Message ID
   * @returns {boolean} Whether message was processed
   */
  isProcessed(threadId, messageId) {
    return this.processed.has(`${threadId}:${messageId}`);
  }

  /**
   * Mark message as processed
   * @param {string} threadId Thread ID
   * @param {string} messageId Message ID
   */
  markProcessed(threadId, messageId) {
    this.processed.add(`${threadId}:${messageId}`);
    
    // Cleanup if set gets too large
    if (this.processed.size > 1000) {
      const oldestEntries = Array.from(this.processed).slice(0, 500);
      oldestEntries.forEach(entry => this.processed.delete(entry));
    }
  }

  /**
   * Check if thread is locked for processing
   * @param {string} threadId Thread ID
   * @returns {boolean} Whether thread is locked
   */
  isThreadLocked(threadId) {
    return this.threadLocks.has(threadId);
  }

  /**
   * Lock thread for processing
   * @param {string} threadId Thread ID
   */
  lockThread(threadId) {
    this.threadLocks.add(threadId);
  }

  /**
   * Unlock thread after processing
   * @param {string} threadId Thread ID
   */
  unlockThread(threadId) {
    this.threadLocks.delete(threadId);
  }
}

// Export singleton instance
export const messageTracker = new ProcessedMessageTracker();