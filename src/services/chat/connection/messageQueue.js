import { logger } from '../../../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';
import { getCurrentTimestamp } from '../utils/timeUtils.js';
import { MessageType } from './types.js';

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second
const MESSAGE_TIMEOUT = 10000; // 10 seconds

export class MessageQueue {
  constructor() {
    this.pendingMessages = new Map();
    this.messageTimeouts = new Map();
    this.retryAttempts = new Map();
    this.confirmedMessages = new Set(); // Track confirmed messages
  }

  addPendingMessage(messageId, ws, message) {
    // Don't add if already confirmed
    if (this.confirmedMessages.has(messageId)) {
      return;
    }

    // Only track messages that need confirmation
    if (message.type === MessageType.MESSAGE || 
        message.type === MessageType.RESPONSE) {
      this.pendingMessages.set(messageId, { ws, message });
      this.setMessageTimeout(messageId);
      
      logger.debug('Message added to pending queue', {
        messageId,
        type: message.type,
        timestamp: getCurrentTimestamp()
      });
    }
  }

  setMessageTimeout(messageId) {
    // Clear existing timeout if any
    this.clearMessageTimeout(messageId);

    const timeout = setTimeout(() => {
      this.handleMessageTimeout(messageId);
    }, MESSAGE_TIMEOUT);

    this.messageTimeouts.set(messageId, timeout);
  }

  clearMessageTimeout(messageId) {
    const timeout = this.messageTimeouts.get(messageId);
    if (timeout) {
      clearTimeout(timeout);
      this.messageTimeouts.delete(messageId);
    }
  }

  async handleMessageTimeout(messageId) {
    // Don't handle timeout if message was confirmed
    if (this.confirmedMessages.has(messageId)) {
      this.cleanupMessage(messageId);
      return;
    }

    const pending = this.pendingMessages.get(messageId);
    if (!pending) return;

    const { ws, message } = pending;
    const retryCount = this.retryAttempts.get(messageId) || 0;

    if (retryCount < MAX_RETRIES) {
      logger.warn('Message delivery timeout, attempting retry', {
        messageId,
        clientId: message.clientId,
        retryCount,
        timestamp: getCurrentTimestamp()
      });

      await this.retryMessage(ws, message, messageId, retryCount);
    } else {
      this.cleanupMessage(messageId);
      logger.error('Message delivery failed after retries', {
        messageId,
        clientId: message.clientId,
        timestamp: getCurrentTimestamp()
      });
    }
  }

  async retryMessage(ws, message, messageId, retryCount) {
    // Don't retry if already confirmed
    if (this.confirmedMessages.has(messageId)) {
      this.cleanupMessage(messageId);
      return;
    }

    const delay = RETRY_DELAY * Math.pow(2, retryCount);
    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      if (ws.readyState !== 1) { // WebSocket.OPEN
        throw new Error('WebSocket not open');
      }

      // Don't retry if message was already confirmed
      if (!this.pendingMessages.has(messageId)) {
        return;
      }

      const serializedMessage = JSON.stringify(message);
      ws.send(serializedMessage);

      this.retryAttempts.set(messageId, retryCount + 1);

      logger.info('Message retry attempt', {
        messageId,
        clientId: message.clientId,
        retryCount: retryCount + 1,
        timestamp: getCurrentTimestamp()
      });
    } catch (error) {
      logger.error('Message retry failed', {
        error: error.message,
        messageId,
        clientId: message.clientId,
        timestamp: getCurrentTimestamp()
      });
      this.cleanupMessage(messageId);
    }
  }

  confirmDelivery(messageId) {
    // Add to confirmed set
    this.confirmedMessages.add(messageId);

    // Clear all tracking for this message
    this.clearMessageTimeout(messageId);
    this.pendingMessages.delete(messageId);
    this.retryAttempts.delete(messageId);
    
    logger.debug('Message delivery confirmed', { 
      messageId,
      timestamp: getCurrentTimestamp()
    });

    // Clean up old confirmed messages periodically
    if (this.confirmedMessages.size > 1000) {
      const oldestMessages = Array.from(this.confirmedMessages).slice(0, 500);
      oldestMessages.forEach(id => this.confirmedMessages.delete(id));
    }

    return true;
  }

  cleanupMessage(messageId) {
    this.clearMessageTimeout(messageId);
    this.pendingMessages.delete(messageId);
    this.retryAttempts.delete(messageId);
    this.confirmedMessages.delete(messageId);
  }

  cleanupClientMessages(clientId) {
    for (const [messageId, data] of this.pendingMessages.entries()) {
      if (data.message.clientId === clientId) {
        this.cleanupMessage(messageId);
      }
    }
  }
}

export const messageQueue = new MessageQueue();