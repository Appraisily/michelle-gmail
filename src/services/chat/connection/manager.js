import { logger } from '../../../utils/logger.js';
import { connectionState } from './state.js';
import { messageQueue } from './messageQueue.js';
import { MessageType, ConnectionState } from './types.js';
import { v4 as uuidv4 } from 'uuid';

export class ConnectionManager {
  constructor() {
    this.state = connectionState;
    this.messageQueue = messageQueue;
  }

  addConnection(ws, clientData) {
    if (ws.readyState <= ConnectionState.OPEN) {
      this.state.addConnection(ws, clientData);
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
    const client = this.state.getConnectionInfo(ws);
    if (client) {
      this.messageQueue.cleanupClientMessages(client.id);
      logger.info('Connection removed', {
        clientId: client.id,
        timestamp: new Date().toISOString()
      });
    }
    this.state.removeConnection(ws);
  }

  async sendMessage(ws, message) {
    try {
      if (!ws || ws.readyState !== ConnectionState.OPEN) {
        logger.warn('Cannot send message - connection not in OPEN state', {
          clientId: message.clientId,
          readyState: ws?.readyState,
          timestamp: new Date().toISOString()
        });
        return false;
      }

      if (!this.state.isConnectionActive(ws)) {
        logger.warn('Cannot send message - connection not active', {
          clientId: message.clientId,
          messageType: message.type,
          timestamp: new Date().toISOString()
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
        clientId: message.clientId,
        type: message.type,
        stack: error.stack,
        timestamp: new Date().toISOString()
      });
      return false;
    }
  }

  confirmMessageDelivery(ws, messageId) {
    return this.messageQueue.confirmDelivery(messageId);
  }

  updateActivity(ws) {
    if (ws && ws.readyState === ConnectionState.OPEN) {
      this.state.updateActivity(ws);
    }
  }

  getConnectionInfo(ws) {
    return this.state.getConnectionInfo(ws);
  }

  getAllConnections() {
    return this.state.getAllConnections();
  }
}

export const connectionManager = new ConnectionManager();