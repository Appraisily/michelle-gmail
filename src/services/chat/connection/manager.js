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

  /**
   * Add new client connection
   * @param {WebSocket} ws WebSocket connection
   * @param {ClientData} clientData Client information
   */
  addConnection(ws, clientData) {
    // Only add if connection is in CONNECTING or OPEN state
    if (ws.readyState <= ConnectionState.OPEN) {
      this.state.addConnection(ws, clientData);
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

  /**
   * Remove client connection
   * @param {WebSocket} ws WebSocket connection
   */
  removeConnection(ws) {
    const client = this.state.getConnectionInfo(ws);
    if (client) {
      this.messageQueue.cleanupClientMessages(client.id);
      logger.info('Connection removed', {
        clientId: client.id,
        readyState: ws.readyState
      });
    }
    this.state.removeConnection(ws);
  }

  /**
   * Send message to client
   * @param {WebSocket} ws WebSocket connection
   * @param {Message} message Message to send
   * @returns {Promise<boolean>} Success status
   */
  async sendMessage(ws, message) {
    try {
      // Double-check connection state
      if (!ws || ws.readyState !== ConnectionState.OPEN) {
        logger.warn('Cannot send message - connection not in OPEN state', {
          clientId: message.clientId,
          readyState: ws?.readyState
        });
        return false;
      }

      if (!this.state.isConnectionActive(ws)) {
        logger.warn('Cannot send message - connection not active in state manager', {
          clientId: message.clientId,
          messageType: message.type
        });
        return false;
      }

      // Ensure message has an ID
      const messageId = message.messageId || uuidv4();
      message.messageId = messageId;

      // Add to pending queue if not a system message
      if (message.type !== MessageType.ERROR && 
          message.type !== MessageType.PONG && 
          message.type !== MessageType.CONFIRM) {
        this.messageQueue.addPendingMessage(messageId, ws, message);
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
        type: message.type,
        clientId: message.clientId,
        stack: error.stack
      });

      return false;
    }
  }

  /**
   * Confirm message delivery
   * @param {WebSocket} ws WebSocket connection
   * @param {string} messageId Message identifier
   * @returns {boolean} Success status
   */
  confirmMessageDelivery(ws, messageId) {
    return this.messageQueue.confirmDelivery(messageId);
  }

  /**
   * Update client activity
   * @param {WebSocket} ws WebSocket connection
   */
  updateActivity(ws) {
    if (ws && ws.readyState === ConnectionState.OPEN) {
      this.state.updateActivity(ws);
    }
  }

  /**
   * Get client connection info
   * @param {WebSocket} ws WebSocket connection
   * @returns {ClientData|null}
   */
  getConnectionInfo(ws) {
    return this.state.getConnectionInfo(ws);
  }

  /**
   * Get all active connections
   * @returns {Array<[WebSocket, ClientData]>}
   */
  getAllConnections() {
    return this.state.getAllConnections();
  }
}

export const connectionManager = new ConnectionManager();