import { logger } from '../../../utils/logger.js';
import { connectionState } from './state.js';
import { messageQueue } from './messageQueue.js';
import { MessageType, ConnectionState, ImageProcessingStatus } from './types.js';
import { v4 as uuidv4 } from 'uuid';

class ConnectionManager {
  constructor() {
    this.state = connectionState;
    this.messageQueue = messageQueue;
    this.imageQueues = new Map();
    this.imageTimeouts = new Map();
  }

  getConnectionInfo(ws) {
    return this.state.getConnectionInfo(ws);
  }

  addConnection(ws, clientData) {
    if (ws.readyState <= ConnectionState.OPEN) {
      this.state.addConnection(ws, clientData);
      this.imageQueues.set(clientData.id, new Set());
      logger.info('New connection added', {
        clientId: clientData.id,
        readyState: ws.readyState
      });
    } else {
      logger.warn('Attempted to add invalid connection', {
        clientId: clientData.id,
        readyState: ws.readyState
      });
    }
  }

  removeConnection(ws) {
    const client = this.state.getConnectionInfo(ws);
    if (client) {
      this.messageQueue.cleanupClientMessages(client.id);
      this.cleanupImageQueue(client.id);
      logger.info('Connection removed', {
        clientId: client.id,
        readyState: ws.readyState
      });
    }
    this.state.removeConnection(ws);
  }

  updateActivity(ws) {
    if (ws && ws.readyState === ConnectionState.OPEN) {
      this.state.updateActivity(ws);
    }
  }

  async sendMessage(ws, message) {
    try {
      if (!ws || ws.readyState !== ConnectionState.OPEN) {
        logger.warn('Cannot send message - connection not in OPEN state', {
          clientId: message.clientId,
          readyState: ws?.readyState
        });
        return false;
      }

      const messageId = message.messageId || uuidv4();
      message.messageId = messageId;

      if (message.type !== MessageType.ERROR && 
          message.type !== MessageType.PONG && 
          message.type !== MessageType.CONFIRM) {
        this.messageQueue.addPendingMessage(messageId, ws, message);
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
        type: message.type,
        clientId: message.clientId,
        stack: error.stack
      });
      return false;
    }
  }

  confirmMessageDelivery(ws, messageId) {
    return this.messageQueue.confirmDelivery(messageId);
  }

  getAllConnections() {
    return this.state.getAllConnections();
  }
}

export const connectionManager = new ConnectionManager();