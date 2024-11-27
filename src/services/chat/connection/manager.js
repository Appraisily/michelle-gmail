import { logger } from '../../../utils/logger.js';
import { connectionState } from './state.js';
import { messageQueue } from './messageQueue.js';
import { MessageType, ConnectionState, ImageProcessingStatus } from './types.js';
import { v4 as uuidv4 } from 'uuid';

const MAX_IMAGE_QUEUE_SIZE = 10; // Maximum number of images being processed at once
const IMAGE_PROCESSING_TIMEOUT = 30000; // 30 seconds timeout for image processing
const MAX_RECONNECT_ATTEMPTS = 5; // Maximum number of reconnection attempts
const RECONNECT_BASE_DELAY = 1000; // Base delay for exponential backoff (1 second)

export class ConnectionManager {
  constructor() {
    this.state = connectionState;
    this.messageQueue = messageQueue;
    this.imageQueues = new Map(); // clientId -> Set of processing image IDs
    this.imageTimeouts = new Map(); // imageId -> timeout handle
    this.reconnectAttempts = new Map(); // clientId -> number of attempts
    this.reconnectTimers = new Map(); // clientId -> timeout handle
  }

  /**
   * Add new client connection with reconnection handling
   * @param {WebSocket} ws WebSocket connection
   * @param {ClientData} clientData Client information
   */
  addConnection(ws, clientData) {
    // Clear any existing reconnection state
    this.clearReconnectionState(clientData.id);

    // Only add if connection is in CONNECTING or OPEN state
    if (ws.readyState <= ConnectionState.OPEN) {
      this.state.addConnection(ws, clientData);
      this.imageQueues.set(clientData.id, new Set());
      logger.info('New connection added', {
        clientId: clientData.id,
        readyState: ws.readyState,
        attempts: this.reconnectAttempts.get(clientData.id) || 0
      });
    } else {
      const attempts = (this.reconnectAttempts.get(clientData.id) || 0) + 1;
      
      if (attempts > MAX_RECONNECT_ATTEMPTS) {
        logger.error('Maximum reconnection attempts reached', {
          clientId: clientData.id,
          attempts
        });
        this.clearReconnectionState(clientData.id);
        return;
      }

      this.reconnectAttempts.set(clientData.id, attempts);
      const delay = RECONNECT_BASE_DELAY * Math.pow(2, attempts - 1);

      logger.warn('Connection failed, scheduling retry', {
        clientId: clientData.id,
        attempts,
        delay,
        readyState: ws.readyState
      });

      // Schedule reconnection attempt
      const timer = setTimeout(() => {
        this.handleReconnection(ws, clientData);
      }, delay);

      this.reconnectTimers.set(clientData.id, timer);
    }
  }

  /**
   * Handle reconnection attempt
   * @param {WebSocket} ws WebSocket connection
   * @param {ClientData} clientData Client information
   */
  handleReconnection(ws, clientData) {
    if (ws.readyState === ConnectionState.OPEN) {
      // Connection is already open, clear reconnection state
      this.clearReconnectionState(clientData.id);
      return;
    }

    // Try to reconnect
    this.addConnection(ws, clientData);
  }

  /**
   * Clear reconnection state for a client
   * @param {string} clientId Client identifier
   */
  clearReconnectionState(clientId) {
    this.reconnectAttempts.delete(clientId);
    const timer = this.reconnectTimers.get(clientId);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(clientId);
    }
  }

  // ... [rest of the existing methods remain unchanged]
}

export const connectionManager = new ConnectionManager();