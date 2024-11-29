import { logger } from '../../../utils/logger.js';
import { connectionState } from './state.js';
import { messageTracker } from './messageTracker.js';
import { messageStore } from '../persistence/messageStore.js';
import { MessageType, MessageStatus, ConnectionState } from './types.js';
import { v4 as uuidv4 } from 'uuid';

export class ConnectionManager {
  constructor() {
    this.state = connectionState;
    this.pendingConfirmations = new Map();
  }

  addConnection(ws, clientData) {
    if (ws.readyState <= ConnectionState.OPEN) {
      // Initialize connection state
      clientData.connectedAt = Date.now();
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

      // Ensure message has an ID
      const messageId = message.messageId || uuidv4();
      message.messageId = messageId;

      // Track message status
      if (message.type === MessageType.MESSAGE || 
          message.type === MessageType.RESPONSE) {
        // Only track non-system messages
        messageTracker.trackMessage(messageId, message.clientId);
        
        // Save message to persistent store
        await messageStore.saveMessage(message.clientId, {
          ...message,
          status: MessageStatus.SENT
        });
      } else if (message.type === MessageType.CONNECT_CONFIRM) {
        // Track connection confirmation
        this.pendingConfirmations.set(message.clientId, {
          timestamp: Date.now(),
          messageId
        });
      }

      // Send the message
      const serializedMessage = JSON.stringify(message);
      ws.send(serializedMessage);

      logger.info('Message sent', {
        messageId,
        clientId: message.clientId,
        type: message.type,
        status: MessageStatus.SENT,
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

      if (message.messageId) {
        messageTracker.updateStatus(message.messageId, MessageStatus.FAILED);
      }

      return false;
    }
  }

  async confirmMessageDelivery(messageId, clientId) {
    messageTracker.updateStatus(messageId, MessageStatus.RECEIVED);
    
    // Update status in persistent store
    await messageStore.updateMessageStatus(clientId, messageId, MessageStatus.RECEIVED);
    
    logger.debug('Message delivery confirmed', {
      messageId,
      clientId,
      status: MessageStatus.RECEIVED,
      timestamp: new Date().toISOString()
    });
  }

  async markMessageProcessed(messageId, clientId) {
    messageTracker.updateStatus(messageId, MessageStatus.PROCESSED);
    
    // Update status in persistent store
    await messageStore.updateMessageStatus(clientId, messageId, MessageStatus.PROCESSED);
    
    logger.debug('Message marked as processed', {
      messageId,
      clientId,
      status: MessageStatus.PROCESSED,
      timestamp: new Date().toISOString()
    });
  }

  updateActivity(ws) {
    if (ws && ws.readyState === ConnectionState.OPEN) {
      this.state.updateActivity(ws);
      const client = this.getConnectionInfo(ws);
      if (client) {
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

  // Clean up old message tracking data periodically
  startCleanupInterval() {
    setInterval(() => {
      messageTracker.cleanup();
    }, 60 * 60 * 1000); // Every hour
  }
}

export const connectionManager = new ConnectionManager();
connectionManager.startCleanupInterval();