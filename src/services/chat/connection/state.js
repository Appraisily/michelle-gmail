import { logger } from '../../../utils/logger.js';
import { ConnectionState } from './types.js';

export class ConnectionStateManager {
  constructor() {
    this.connections = new Map();
  }

  /**
   * Add a new client connection
   * @param {WebSocket} ws WebSocket connection
   * @param {ClientData} clientData Client information
   */
  addConnection(ws, clientData) {
    this.connections.set(ws, {
      ...clientData,
      pendingConfirmations: new Set(),
      lastActivity: Date.now()
    });
    
    logger.debug('Client connection added', {
      clientId: clientData.id,
      conversationId: clientData.conversationId
    });
  }

  /**
   * Remove a client connection
   * @param {WebSocket} ws WebSocket connection
   */
  removeConnection(ws) {
    const client = this.connections.get(ws);
    if (client) {
      logger.debug('Client connection removed', {
        clientId: client.id,
        conversationId: client.conversationId
      });
    }
    this.connections.delete(ws);
  }

  /**
   * Check if connection is active
   * @param {WebSocket} ws WebSocket connection
   * @returns {boolean}
   */
  isConnectionActive(ws) {
    if (!ws || typeof ws.readyState !== 'number') {
      return false;
    }

    const connection = this.connections.get(ws);
    if (!connection) {
      return false;
    }

    // WebSocket.OPEN is 1
    const isOpen = ws.readyState === ConnectionState.OPEN;
    if (!isOpen) {
      logger.debug('Connection not active', {
        clientId: connection.id,
        readyState: ws.readyState
      });
    }

    return isOpen;
  }

  /**
   * Update client activity timestamp
   * @param {WebSocket} ws WebSocket connection
   */
  updateActivity(ws) {
    const connection = this.connections.get(ws);
    if (connection) {
      connection.lastActivity = Date.now();
      logger.debug('Updated client activity', {
        clientId: connection.id,
        timestamp: new Date(connection.lastActivity).toISOString()
      });
    }
  }

  /**
   * Get client connection data
   * @param {WebSocket} ws WebSocket connection
   * @returns {ClientData|null}
   */
  getConnectionInfo(ws) {
    return this.connections.get(ws) || null;
  }

  /**
   * Get all active connections
   * @returns {Array<[WebSocket, ClientData]>}
   */
  getAllConnections() {
    return Array.from(this.connections.entries());
  }

  /**
   * Clean up inactive connections
   * @param {number} inactivityThreshold Time in ms before connection is considered inactive
   */
  cleanupInactiveConnections(inactivityThreshold) {
    const now = Date.now();
    for (const [ws, client] of this.connections.entries()) {
      if (now - client.lastActivity > inactivityThreshold) {
        logger.info('Removing inactive connection', {
          clientId: client.id,
          inactiveTime: now - client.lastActivity
        });
        this.removeConnection(ws);
        ws.terminate();
      }
    }
  }
}

export const connectionState = new ConnectionStateManager();