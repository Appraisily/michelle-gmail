import { logger } from '../../../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second
const MESSAGE_TIMEOUT = 5000; // 5 seconds

export class MessageQueue {
  constructor() {
    this.pendingMessages = new Map();
    this.messageTimeouts = new Map();
    this.retryAttempts = new Map();
  }

  /**
   * Add message to pending queue
   * @param {string} messageId Message identifier
   * @param {WebSocket} ws WebSocket connection
   * @param {Message} message Message data
   */
  addPendingMessage(messageId, ws, message) {
    this.pendingMessages.set(messageId, { ws, message });
    this.setMessageTimeout(messageId);
  }

  /**
   * Set timeout for message confirmation
   * @param {string} messageId Message identifier
   */
  setMessageTimeout(messageId) {
    const timeout = setTimeout(() => {
      this.handleMessageTimeout(messageId);
    }, MESSAGE_TIMEOUT);

    this.messageTimeouts.set(messageId, timeout);
  }

  /**
   * Clear message timeout
   * @param {string} messageId Message identifier
   */
  clearMessageTimeout(messageId) {
    const timeout = this.messageTimeouts.get(messageId);
    if (timeout) {
      clearTimeout(timeout);
      this.messageTimeouts.delete(messageId);
    }
  }

  /**
   * Handle message timeout
   * @param {string} messageId Message identifier
   */
  async handleMessageTimeout(messageId) {
    const pending = this.pendingMessages.get(messageId);
    if (!pending) return;

    const { ws, message } = pending;
    const retryKey = `${message.clientId}:${messageId}`;
    const retryCount = this.retryAttempts.get(retryKey) || 0;

    if (retryCount < MAX_RETRIES) {
      logger.warn('Message delivery timeout, attempting retry', {
        messageId,
        clientId: message.clientId,
        retryCount
      });

      await this.retryMessage(ws, message, retryCount);
    } else {
      this.cleanupMessage(messageId);
      logger.error('Message delivery failed after retries', {
        messageId,
        clientId: message.clientId
      });
    }
  }

  /**
   * Retry sending a message
   * @param {WebSocket} ws WebSocket connection
   * @param {Message} message Message to retry
   * @param {number} retryCount Current retry attempt
   */
  async retryMessage(ws, message, retryCount) {
    const retryKey = `${message.clientId}:${message.messageId}`;
    const delay = RETRY_DELAY * Math.pow(2, retryCount);

    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      const serializedMessage = JSON.stringify(message);
      ws.send(serializedMessage);

      this.retryAttempts.set(retryKey, retryCount + 1);

      logger.info('Message retry attempt', {
        messageId: message.messageId,
        clientId: message.clientId,
        retryCount: retryCount + 1
      });
    } catch (error) {
      logger.error('Message retry failed', {
        error: error.message,
        messageId: message.messageId,
        clientId: message.clientId
      });
    }
  }

  /**
   * Confirm message delivery
   * @param {string} messageId Message identifier
   */
  confirmDelivery(messageId) {
    this.clearMessageTimeout(messageId);
    this.pendingMessages.delete(messageId);
    
    logger.debug('Message delivery confirmed', { messageId });
  }

  /**
   * Clean up message data
   * @param {string} messageId Message identifier
   */
  cleanupMessage(messageId) {
    this.clearMessageTimeout(messageId);
    this.pendingMessages.delete(messageId);
  }

  /**
   * Clean up all message data for a client
   * @param {string} clientId Client identifier
   */
  cleanupClientMessages(clientId) {
    for (const [messageId, data] of this.pendingMessages.entries()) {
      if (data.message.clientId === clientId) {
        this.cleanupMessage(messageId);
      }
    }

    // Clean up retry attempts
    for (const key of this.retryAttempts.keys()) {
      if (key.startsWith(`${clientId}:`)) {
        this.retryAttempts.delete(key);
      }
    }
  }
}

export const messageQueue = new MessageQueue();