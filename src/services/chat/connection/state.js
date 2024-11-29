import { logger } from '../../../utils/logger.js';
import { ConnectionState } from './types.js';

export class ConnectionStateManager {
  constructor() {
    this.connections = new Map();
  }

  addConnection(ws, clientData) {
    // Only add if connection is in CONNECTING or OPEN state
    if (ws.readyState <= ConnectionState.OPEN) {
      const now = Date.now();
      this.connections.set(ws, {
        ...clientData,
        pendingConfirmations: new Set(),
        lastActivity: now,
        connectedAt: now,
        lastPong: now
      });
      
      logger.debug('Client connection added', {
        clientId: clientData.id,
        conversationId: clientData.conversationId,
        readyState: ws.readyState
      });
    } else {
      logger.warn('Attempted to add invalid connection', {
        clientId: clientData.id,
        readyState: ws.readyState
      });
    }
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

    // Check if connection is OPEN (1)
    return ws.readyState === ConnectionState.OPEN;
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
    return this.connections.get(ws);
  }

  getAllConnections() {
    return Array.from(this.connections.entries());
  }

  cleanupInactiveConnections(inactivityThreshold) {
    const now = Date.now();
    for (const [ws, client] of this.connections.entries()) {
      // Skip cleanup during initial grace period
      const connectionAge = now - client.connectedAt;
      if (connectionAge < 45000) { // 45 second grace period
        continue;
      }

      // Check for inactivity after grace period
      const inactiveTime = now - client.lastActivity;
      if (inactiveTime > inactivityThreshold) {
        logger.info('Removing inactive connection', {
          clientId: client.id,
          inactiveTime,
          connectionAge,
          timestamp: new Date().toISOString()
        });
        this.removeConnection(ws);
        ws.terminate();
      }
    }
  }
}

export const connectionState = new ConnectionStateManager();