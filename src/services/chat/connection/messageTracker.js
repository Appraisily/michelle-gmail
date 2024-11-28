import { logger } from '../../../utils/logger.js';
import { MessageStatus } from './types.js';

export class MessageTracker {
  constructor() {
    this.messages = new Map();
  }

  /**
   * Track new message
   * @param {string} messageId Message identifier
   * @param {string} clientId Client identifier
   */
  trackMessage(messageId, clientId) {
    this.messages.set(messageId, {
      clientId,
      status: MessageStatus.SENT,
      timestamp: Date.now()
    });

    logger.debug('Message tracked', {
      messageId,
      clientId,
      status: MessageStatus.SENT,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Update message status
   * @param {string} messageId Message identifier
   * @param {MessageStatus} status New status
   */
  updateStatus(messageId, status) {
    const message = this.messages.get(messageId);
    if (message) {
      message.status = status;
      message.lastUpdate = Date.now();

      logger.debug('Message status updated', {
        messageId,
        clientId: message.clientId,
        status,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Get message status
   * @param {string} messageId Message identifier
   * @returns {MessageStatus|null} Current message status
   */
  getStatus(messageId) {
    return this.messages.get(messageId)?.status || null;
  }

  /**
   * Clean up old message tracking
   * @param {number} maxAge Maximum age in milliseconds
   */
  cleanup(maxAge = 3600000) { // Default 1 hour
    const now = Date.now();
    for (const [messageId, data] of this.messages.entries()) {
      if (now - data.timestamp > maxAge) {
        this.messages.delete(messageId);
      }
    }
  }
}

export const messageTracker = new MessageTracker();