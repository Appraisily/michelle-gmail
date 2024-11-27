import { logger } from '../../../utils/logger.js';
import { MessageType, ConnectionState, ImageProcessingStatus } from './types.js';
import { v4 as uuidv4 } from 'uuid';

class ConnectionManager {
  constructor() {
    this.connections = new Map();
    this.pendingMessages = new Map();
    this.messageTimeouts = new Map();
    this.retryAttempts = new Map();
    this.imageQueues = new Map();
    this.imageTimeouts = new Map();
  }

  addConnection(ws, clientData) {
    if (ws.readyState <= ConnectionState.OPEN) {
      this.connections.set(ws, {
        ...clientData,
        pendingConfirmations: new Set(),
        lastActivity: Date.now()
      });
      this.imageQueues.set(clientData.id, new Set());
      
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
    const client = this.getConnectionInfo(ws);
    if (client) {
      // Clear any pending message timeouts
      client.pendingConfirmations.forEach(messageId => {
        this.clearMessageTimeout(messageId);
      });
      
      // Clear image processing queues
      this.cleanupImageQueue(client.id);
      
      logger.info('Connection removed', {
        clientId: client.id,
        timestamp: new Date().toISOString()
      });
    }
    this.connections.delete(ws);
  }

  isConnectionActive(ws) {
    return ws && 
           ws.readyState === ConnectionState.OPEN && 
           this.connections.has(ws);
  }

  async sendMessage(ws, message) {
    try {
      if (!this.isConnectionActive(ws)) {
        logger.warn('Cannot send message - connection not in OPEN state', {
          clientId: message.clientId,
          readyState: ws?.readyState,
          timestamp: new Date().toISOString()
        });
        return false;
      }

      const messageId = message.messageId || uuidv4();
      message.messageId = messageId;

      // Track non-system messages for confirmation
      if (message.type !== MessageType.ERROR && 
          message.type !== MessageType.PONG && 
          message.type !== MessageType.CONFIRM) {
        const client = this.getConnectionInfo(ws);
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

  setMessageTimeout(messageId, ws, message) {
    const timeout = setTimeout(() => {
      this.handleMessageTimeout(messageId, ws, message);
    }, 5000);

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
    const client = this.getConnectionInfo(ws);
    if (!client) return;

    const retryKey = `${message.clientId}:${messageId}`;
    const retryCount = this.retryAttempts.get(retryKey) || 0;

    if (retryCount < 3) {
      logger.warn('Message delivery timeout, attempting retry', {
        messageId,
        clientId: client.id,
        retryCount,
        timestamp: new Date().toISOString()
      });

      await this.retryMessage(ws, message, retryCount);
    } else {
      client.pendingConfirmations.delete(messageId);
      this.messageTimeouts.delete(messageId);
      this.retryAttempts.delete(retryKey);

      logger.error('Message delivery failed after retries', {
        messageId,
        clientId: client.id,
        type: message.type,
        timestamp: new Date().toISOString()
      });
    }
  }

  async retryMessage(ws, message, retryCount) {
    const retryKey = `${message.clientId}:${message.messageId}`;
    const delay = 1000 * Math.pow(2, retryCount);
    
    await new Promise(resolve => setTimeout(resolve, delay));

    if (this.isConnectionActive(ws)) {
      const serializedMessage = JSON.stringify(message);
      ws.send(serializedMessage);

      this.retryAttempts.set(retryKey, retryCount + 1);

      logger.info('Message retry attempt', {
        messageId: message.messageId,
        clientId: message.clientId,
        retryCount: retryCount + 1,
        timestamp: new Date().toISOString()
      });

      return true;
    }

    return false;
  }

  confirmMessageDelivery(ws, messageId) {
    const client = this.getConnectionInfo(ws);
    if (!client) return false;

    if (client.pendingConfirmations.has(messageId)) {
      client.pendingConfirmations.delete(messageId);
      this.clearMessageTimeout(messageId);
      
      // Clear retry attempts
      const retryKey = `${client.id}:${messageId}`;
      this.retryAttempts.delete(retryKey);
      
      return true;
    }
    return false;
  }

  updateActivity(ws) {
    const client = this.getConnectionInfo(ws);
    if (client) {
      client.lastActivity = Date.now();
    }
  }

  getConnectionInfo(ws) {
    return this.connections.get(ws);
  }

  getAllConnections() {
    return Array.from(this.connections.entries());
  }

  cleanupImageQueue(clientId) {
    const queue = this.imageQueues.get(clientId);
    if (queue) {
      for (const imageId of queue) {
        const timeout = this.imageTimeouts.get(imageId);
        if (timeout) {
          clearTimeout(timeout);
          this.imageTimeouts.delete(imageId);
        }
      }
      this.imageQueues.delete(clientId);
    }
  }
}

export const connectionManager = new ConnectionManager();