import { logger } from '../../../utils/logger.js';
import { connectionState } from './state.js';
import { messageQueue } from './messageQueue.js';
import { MessageType, ConnectionState } from './types.js';
import { v4 as uuidv4 } from 'uuid';
import { getCurrentTimestamp } from '../utils/timeUtils.js';

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
        timestamp: getCurrentTimestamp()
      });
    }
  }

  removeConnection(ws) {
    const client = this.state.getConnectionInfo(ws);
    if (client) {
      // Clean up any pending messages
      this.messageQueue.cleanupClientMessages(client.id);
      
      logger.info('Connection removed', {
        clientId: client.id,
        readyState: ws.readyState,
        timestamp: getCurrentTimestamp()
      });
    }
    this.state.removeConnection(ws);
  }

  async sendMessage(ws, message) {
    try {
      if (!ws || ws.readyState !== ConnectionState.OPEN) {
        logger.debug('Cannot send message - connection not in OPEN state', {
          clientId: message.clientId,
          readyState: ws?.readyState,
          timestamp: getCurrentTimestamp()
        });
        return false;
      }

      // Ensure message has an ID
      const messageId = message.messageId || uuidv4();
      message.messageId = messageId;

      // Update activity timestamp for all message types
      this.state.updateActivity(ws, message.type);

      // Add to message queue if it's a message that needs confirmation
      if (message.type === MessageType.MESSAGE || 
          message.type === MessageType.RESPONSE) {
        this.messageQueue.addPendingMessage(messageId, ws, message);
      }

      // Send the message
      const serializedMessage = JSON.stringify(message);
      ws.send(serializedMessage);

      logger.info('Message sent', {
        messageId,
        clientId: message.clientId,
        type: message.type,
        status: message.status,
        timestamp: getCurrentTimestamp()
      });

      return true;
    } catch (error) {
      logger.error('Failed to send message', {
        error: error.message,
        type: message.type,
        clientId: message.clientId,
        stack: error.stack,
        timestamp: getCurrentTimestamp()
      });
      return false;
    }
  }

  confirmMessageDelivery(messageId) {
    return this.messageQueue.confirmDelivery(messageId);
  }

  getConnectionInfo(ws) {
    return this.state.getConnectionInfo(ws);
  }

  getAllConnections() {
    return this.state.getAllConnections();
  }
}

export const connectionManager = new ConnectionManager();