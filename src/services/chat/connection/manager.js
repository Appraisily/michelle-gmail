import { logger } from '../../../utils/logger.js';
import { MessageType, ConnectionState } from './types.js';
import { v4 as uuidv4 } from 'uuid';

export class ConnectionManager {
  constructor() {
    this.connections = new Map();
    this.pendingMessages = new Map();
    this.messageTimeouts = new Map();
  }

  addConnection(ws, clientData) {
    // Only add if connection is in CONNECTING or OPEN state
    if (ws.readyState <= ConnectionState.OPEN) {
      this.connections.set(ws, {
        ...clientData,
        pendingConfirmations: new Set(),
        lastActivity: Date.now()
      });
      
      logger.info('New connection added', {
        clientId: clientData.id,
        readyState: ws.readyState,
        timestamp: new Date().toISOString()
      });
    } else {
      logger.warn('Attempted to add invalid connection', {
        clientId: clientData.id,
        readyState: ws.readyState,
        timestamp: new Date().toISOString()
      });
    }
  }

  removeConnection(ws) {
    const client = this.connections.get(ws);
    if (client) {
      // Clear any pending message timeouts
      client.pendingConfirmations.forEach(messageId => {
        this.clearMessageTimeout(messageId);
      });
    }
    this.connections.delete(ws);
  }

  isConnectionActive(ws) {
    if (!ws || typeof ws.readyState !== 'number') {
      return false;
    }

    const connection = this.connections.get(ws);
    if (!connection) {
      return false;
    }

    // Check if connection is OPEN (1)
    return ws.readyState === ConnectionState.OPEN;
  }

  async sendMessage(ws, message) {
    try {
      // Double-check connection state
      if (!ws || ws.readyState !== ConnectionState.OPEN) {
        logger.warn('Cannot send message - connection not in OPEN state', {
          clientId: message.clientId,
          readyState: ws?.readyState,
          timestamp: new Date().toISOString()
        });
        return false;
      }

      if (!this.isConnectionActive(ws)) {
        logger.warn('Cannot send message - connection not active', {
          clientId: message.clientId,
          messageType: message.type,
          timestamp: new Date().toISOString()
        });
        return false;
      }

      const messageId = message.messageId || uuidv4();
      message.messageId = messageId;

      // Add to pending confirmations if not a system message
      if (message.type !== MessageType.ERROR && 
          message.type !== MessageType.PONG && 
          message.type !== MessageType.CONFIRM) {
        const client = this.connections.get(ws);
        client.pendingConfirmations.add(messageId);
        this.setMessageTimeout(messageId, ws, message);
      }

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
        stack: error.stack,
        timestamp: new Date().toISOString()
      });
      return false;
    }
  }

  confirmMessageDelivery(ws, messageId) {
    const client = this.connections.get(ws);
    if (!client) return false;

    if (client.pendingConfirmations.has(messageId)) {
      client.pendingConfirmations.delete(messageId);
      this.clearMessageTimeout(messageId);
      return true;
    }
    return false;
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

  setMessageTimeout(messageId, ws, message) {
    const timeout = setTimeout(() => {
      this.handleMessageTimeout(messageId, ws, message);
    }, 5000); // 5 second timeout

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
    const client = this.connections.get(ws);
    if (!client) return;

    if (client.pendingConfirmations.has(messageId)) {
      logger.warn('Message delivery timeout', {
        messageId,
        clientId: message.clientId,
        timestamp: new Date().toISOString()
      });

      // Clean up
      client.pendingConfirmations.delete(messageId);
      this.messageTimeouts.delete(messageId);
    }
  }
}

export const connectionManager = new ConnectionManager();