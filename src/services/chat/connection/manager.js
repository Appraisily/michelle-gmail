import { logger } from '../../../utils/logger.js';
import { connectionState } from './state.js';
import { messageQueue } from './messageQueue.js';
import { MessageType, ConnectionState, ConnectionStatus } from './types.js';
import { v4 as uuidv4 } from 'uuid';

const MAX_IMAGE_QUEUE_SIZE = 10;
const IMAGE_PROCESSING_TIMEOUT = 30000;

export class ConnectionManager {
  constructor() {
    this.state = connectionState;
    this.messageQueue = messageQueue;
    this.imageQueues = new Map();
    this.imageTimeouts = new Map();
  }

  addConnection(ws, clientData) {
    if (ws.readyState <= ConnectionState.OPEN) {
      // Initialize client data with pending status
      const initializedData = {
        ...clientData,
        connectionStatus: ConnectionStatus.PENDING
      };

      this.state.addConnection(ws, initializedData);
      this.imageQueues.set(clientData.id, new Set());

      // Send connection confirmation request
      this.sendMessage(ws, {
        type: MessageType.CONNECT_CONFIRM,
        clientId: clientData.id,
        messageId: uuidv4(),
        timestamp: new Date().toISOString()
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

  confirmConnection(ws) {
    const client = this.state.getConnectionInfo(ws);
    if (client) {
      client.connectionStatus = ConnectionStatus.CONFIRMED;
      logger.info('Connection confirmed', {
        clientId: client.id,
        timestamp: new Date().toISOString()
      });
      return true;
    }
    return false;
  }

  removeConnection(ws) {
    const client = this.state.getConnectionInfo(ws);
    if (client) {
      this.messageQueue.cleanupClientMessages(client.id);
      this.cleanupImageQueue(client.id);
      logger.info('Connection removed', {
        clientId: client.id,
        readyState: ws.readyState,
        timestamp: new Date().toISOString()
      });
    }
    this.state.removeConnection(ws);
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

      const client = this.state.getConnectionInfo(ws);
      if (!client) {
        logger.warn('Cannot send message - no client info', {
          clientId: message.clientId,
          timestamp: new Date().toISOString()
        });
        return false;
      }

      // Only allow certain message types before confirmation
      if (client.connectionStatus !== ConnectionStatus.CONFIRMED &&
          message.type !== MessageType.CONNECT_CONFIRM &&
          message.type !== MessageType.ERROR) {
        logger.warn('Cannot send message - connection not confirmed', {
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
        type: message.type,
        clientId: message.clientId,
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