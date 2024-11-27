import { logger } from '../../../utils/logger.js';
import { connectionState } from './state.js';
import { messageQueue } from './messageQueue.js';
import { MessageType, ConnectionState, ImageProcessingStatus } from './types.js';
import { v4 as uuidv4 } from 'uuid';

const MAX_IMAGE_QUEUE_SIZE = 10; // Maximum number of images being processed at once
const IMAGE_PROCESSING_TIMEOUT = 30000; // 30 seconds timeout for image processing

export class ConnectionManager {
  constructor() {
    this.state = connectionState;
    this.messageQueue = messageQueue;
    this.imageQueues = new Map(); // clientId -> Set of processing image IDs
    this.imageTimeouts = new Map(); // imageId -> timeout handle
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

  /**
   * Remove client connection
   * @param {WebSocket} ws WebSocket connection
   */
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

  /**
   * Clean up image processing queue for a client
   * @param {string} clientId Client identifier
   */
  cleanupImageQueue(clientId) {
    const queue = this.imageQueues.get(clientId);
    if (queue) {
      // Clear all image timeouts
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

  /**
   * Add image to processing queue
   * @param {string} clientId Client identifier
   * @param {string} imageId Image identifier
   * @param {WebSocket} ws WebSocket connection
   * @param {string} messageId Original message ID
   * @returns {boolean} Whether image was added to queue
   */
  addImageToQueue(clientId, imageId, ws, messageId) {
    const queue = this.imageQueues.get(clientId);
    if (!queue) return false;

    if (queue.size >= MAX_IMAGE_QUEUE_SIZE) {
      logger.warn('Image queue full', { clientId, imageId });
      return false;
    }

    queue.add(imageId);

    // Set timeout for image processing
    const timeout = setTimeout(() => {
      this.handleImageTimeout(clientId, imageId, ws, messageId);
    }, IMAGE_PROCESSING_TIMEOUT);

    this.imageTimeouts.set(imageId, timeout);

    logger.debug('Image added to processing queue', {
      clientId,
      imageId,
      queueSize: queue.size
    });

    return true;
  }

  /**
   * Handle image processing timeout
   * @param {string} clientId Client identifier
   * @param {string} imageId Image identifier
   * @param {WebSocket} ws WebSocket connection
   * @param {string} messageId Original message ID
   */
  async handleImageTimeout(clientId, imageId, ws, messageId) {
    const queue = this.imageQueues.get(clientId);
    if (!queue || !queue.has(imageId)) return;

    logger.warn('Image processing timeout', {
      clientId,
      imageId,
      messageId
    });

    // Send failed status
    await this.sendMessage(ws, {
      type: MessageType.CONFIRM,
      clientId,
      messageId,
      imageId,
      status: ImageProcessingStatus.FAILED,
      error: 'Processing timeout',
      timestamp: new Date().toISOString()
    });

    // Clean up
    queue.delete(imageId);
    this.imageTimeouts.delete(imageId);
  }

  /**
   * Update image processing status
   * @param {string} clientId Client identifier
   * @param {string} imageId Image identifier
   * @param {ImageProcessingStatus} status New status
   * @returns {boolean} Success status
   */
  updateImageStatus(clientId, imageId, status) {
    const queue = this.imageQueues.get(clientId);
    if (!queue || !queue.has(imageId)) return false;

    if (status === ImageProcessingStatus.ANALYZED || 
        status === ImageProcessingStatus.FAILED) {
      queue.delete(imageId);
      const timeout = this.imageTimeouts.get(imageId);
      if (timeout) {
        clearTimeout(timeout);
        this.imageTimeouts.delete(imageId);
      }
    }

    logger.debug('Image status updated', {
      clientId,
      imageId,
      status,
      queueSize: queue.size
    });

    return true;
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