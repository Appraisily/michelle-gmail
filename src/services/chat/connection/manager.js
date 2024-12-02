import { logger } from '../../../utils/logger.js';
import { connectionState } from './state.js';
import { messageQueue } from './messageQueue.js';
import { MessageType, ConnectionState, ImageProcessingStatus } from './types.js';
import { v4 as uuidv4 } from 'uuid';

export class ConnectionManager {
  constructor() {
    this.state = connectionState;
    this.messageQueue = messageQueue;
  }

  addConnection(ws, clientData) {
    if (ws.readyState <= ConnectionState.OPEN) {
      // Initialize connection state
      clientData.connectedAt = Date.now();
      clientData.lastMessage = Date.now();
      clientData.lastPong = Date.now();
      clientData.isAlive = true;

      this.state.addConnection(ws, clientData);
      logger.info('New connection added', {
        clientId: clientData.id,
        readyState: ws.readyState,
        timestamp: new Date().toISOString()
      });
    }
  }

  removeConnection(ws) {
    const client = this.state.getConnectionInfo(ws);
    if (client) {
      logger.info('Connection removed', {
        clientId: client.id,
        readyState: ws.readyState,
        timestamp: new Date().toISOString()
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
          timestamp: new Date().toISOString()
        });
        return false;
      }

      // Get client info to update activity
      const client = this.getConnectionInfo(ws);
      if (client) {
        // Update lastMessage for ALL message types
        client.lastMessage = Date.now();
      }

      // Ensure message has an ID
      const messageId = message.messageId || uuidv4();
      message.messageId = messageId;

      // Track message status
      if (message.type === MessageType.MESSAGE || 
          message.type === MessageType.RESPONSE) {
        // Only track non-system messages
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

  updateActivity(ws) {
    if (ws && ws.readyState === ConnectionState.OPEN) {
      const client = this.getConnectionInfo(ws);
      if (client) {
        client.lastMessage = Date.now();
        client.lastActivity = Date.now();
      }
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