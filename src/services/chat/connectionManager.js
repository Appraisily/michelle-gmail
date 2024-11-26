import { logger } from '../../utils/logger.js';
import { MessageType } from './types.js';
import { v4 as uuidv4 } from 'uuid';

export class ConnectionManager {
  constructor() {
    this.connections = new Map();
    this.pendingMessages = new Map();
    this.messageTimeouts = new Map();
    this.MESSAGE_TIMEOUT = 5000; // 5 seconds
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
    }
    this.connections.delete(ws);
  }

  isConnectionActive(ws) {
    const connection = this.connections.get(ws);
    return connection && ws.readyState === ws.OPEN;
  }

  setMessageTimeout(messageId, ws, message) {
    const timeout = setTimeout(() => {
      this.handleMessageTimeout(messageId, ws, message);
    }, this.MESSAGE_TIMEOUT);

    this.messageTimeouts.set(messageId, timeout);
  }

  clearMessageTimeout(messageId) {
    const timeout = this.messageTimeouts.get(messageId);
    if (timeout) {
      clearTimeout(timeout);
      this.messageTimeouts.delete(messageId);
    }
  }

  handleMessageTimeout(messageId, ws, message) {
    const connection = this.connections.get(ws);
    if (connection) {
      connection.pendingConfirmations.delete(messageId);
      logger.warn('Message delivery timeout', {
        messageId,
        clientId: connection.id,
        messageType: message.type
      });
    }
    this.messageTimeouts.delete(messageId);
  }

  confirmMessageDelivery(ws, messageId) {
    const connection = this.connections.get(ws);
    if (connection && connection.pendingConfirmations.has(messageId)) {
      connection.pendingConfirmations.delete(messageId);
      this.clearMessageTimeout(messageId);
      
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

      // Add to pending confirmations
      const connection = this.connections.get(ws);
      connection.pendingConfirmations.add(messageId);

      // Send the message
      const serializedMessage = JSON.stringify(message);
      ws.send(serializedMessage);

      // Set timeout for confirmation
      this.setMessageTimeout(messageId, ws, message);

      logger.info('Message sent', {
        messageId,
        clientId: connection.id,
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
}

export const connectionManager = new ConnectionManager();