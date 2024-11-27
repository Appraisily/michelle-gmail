import { logger } from '../../../utils/logger.js';
import { ConnectionState } from './types.js';

export class ConnectionStateManager {
  constructor() {
    this.connections = new Map();
  }

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

  getConnectionInfo(ws) {
    return this.connections.get(ws) || null;
  }

  getAllConnections() {
    return Array.from(this.connections.entries());
  }

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