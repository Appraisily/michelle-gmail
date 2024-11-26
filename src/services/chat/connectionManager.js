import { logger } from '../../utils/logger.js';
import { MessageType } from './types.js';
import { v4 as uuidv4 } from 'uuid';

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second
const MESSAGE_TIMEOUT = 5000; // 5 seconds

export class ConnectionManager {
  constructor() {
    this.connections = new Map();
    this.pendingMessages = new Map();
    this.messageTimeouts = new Map();
    this.retryAttempts = new Map();
  }

  addConnection(ws, clientData) {
    this.connections.set(ws, {
      ...clientData,
      pendingConfirmations: new Set(),
      lastActivity: Date.now()
    });
  }

  removeConnection(ws) {
    const clientData = this.connections.get(ws);
    if (clientData) {
      // Clear any pending message timeouts
      clientData.pendingConfirmations.forEach(messageId => {
        this.clearMessageTimeout(messageId);
      });
      // Clear retry attempts
      Array.from(this.retryAttempts.keys())
        .filter(key => key.startsWith(`${clientData.id}:`))
        .forEach(key => this.retryAttempts.delete(key));
    }
    this.connections.delete(ws);
  }

  isConnectionActive(ws) {
    const connection = this.connections.get(ws);
    if (!connection) return false;
    
    // Check both connection existence and WebSocket state
    return ws.readyState === 1; // Only consider OPEN state as active
  }

  async retryMessage(ws, message, retryCount = 0) {
    const retryKey = `${message.clientId}:${message.messageId}`;
    
    if (retryCount >= MAX_RETRIES) {
      logger.error('Max retries reached for message', {
        messageId: message.messageId,
        clientId: message.clientId,
        retryCount
      });
      this.retryAttempts.delete(retryKey);
      return false;
    }

    // Exponential backoff
    const delay = RETRY_DELAY * Math.pow(2, retryCount);
    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      if (!this.isConnectionActive(ws)) {
        throw new Error('Connection not active');
      }

      const serializedMessage = JSON.stringify(message);
      ws.send(serializedMessage);

      this.retryAttempts.set(retryKey, retryCount + 1);

      logger.info('Message retry attempt', {
        messageId: message.messageId,
        clientId: message.clientId,
        retryCount: retryCount + 1,
        delay
      });

      return true;
    } catch (error) {
      logger.warn('Message retry failed', {
        error: error.message,
        messageId: message.messageId,
        clientId: message.clientId,
        retryCount
      });

      // Schedule next retry
      return this.retryMessage(ws, message, retryCount + 1);
    }
  }

  setMessageTimeout(messageId, ws, message) {
    const timeout = setTimeout(() => {
      this.handleMessageTimeout(messageId, ws, message);
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

  async handleMessageTimeout(messageId, ws, message) {
    const connection = this.connections.get(ws);
    if (!connection) return;

    const retryKey = `${message.clientId}:${messageId}`;
    const retryCount = this.retryAttempts.get(retryKey) || 0;

    if (retryCount < MAX_RETRIES) {
      logger.warn('Message delivery timeout, attempting retry', {
        messageId,
        clientId: connection.id,
        messageType: message.type,
        retryCount
      });

      // Attempt retry
      const success = await this.retryMessage(ws, message, retryCount);
      if (success) return;
    }

    // If retries exhausted or failed, clean up
    connection.pendingConfirmations.delete(messageId);
    this.messageTimeouts.delete(messageId);
    this.retryAttempts.delete(retryKey);

    logger.error('Message delivery failed after retries', {
      messageId,
      clientId: connection.id,
      messageType: message.type,
      retryCount
    });
  }

  confirmMessageDelivery(ws, messageId) {
    const connection = this.connections.get(ws);
    if (!connection) return false;

    if (connection.pendingConfirmations.has(messageId)) {
      connection.pendingConfirmations.delete(messageId);
      this.clearMessageTimeout(messageId);
      
      // Clear retry attempts
      const retryKey = `${connection.id}:${messageId}`;
      this.retryAttempts.delete(retryKey);
      
      logger.debug('Message delivery confirmed', {
        messageId,
        clientId: connection.id
      });
      return true;
    }
    return false;
  }

  async sendMessage(ws, message) {
    if (!this.isConnectionActive(ws)) {
      logger.error('Cannot send message - connection not active', {
        clientId: message.clientId,
        messageType: message.type,
        readyState: ws.readyState
      });
      return false;
    }

    try {
      // Ensure message has an ID
      const messageId = message.messageId || uuidv4();
      message.messageId = messageId;

      // Add to pending confirmations if not an error or system message
      if (message.type !== MessageType.ERROR && 
          message.type !== MessageType.PONG && 
          message.type !== MessageType.CONFIRM) {
        const connection = this.connections.get(ws);
        connection.pendingConfirmations.add(messageId);
        
        // Set timeout for confirmation
        this.setMessageTimeout(messageId, ws, message);
      }

      // Send the message
      const serializedMessage = JSON.stringify(message);
      ws.send(serializedMessage);

      logger.info('Message sent', {
        messageId,
        clientId: message.clientId,
        type: message.type,
        timestamp: new Date().toISOString()
      });

      return true;
    } catch (error) {
      logger.error('Failed to send message', {
        error: error.message,
        clientId: message.clientId,
        type: message.type,
        stack: error.stack
      });

      // Attempt retry for non-system messages
      if (message.type !== MessageType.ERROR && 
          message.type !== MessageType.PONG && 
          message.type !== MessageType.CONFIRM) {
        return this.retryMessage(ws, message);
      }

      return false;
    }
  }

  updateActivity(ws) {
    const connection = this.connections.get(ws);
    if (connection) {
      connection.lastActivity = Date.now();
    }
  }

  getConnectionInfo(ws) {
    return this.connections.get(ws);
  }

  getAllConnections() {
    return Array.from(this.connections.entries());
  }
}

export const connectionManager = new ConnectionManager();