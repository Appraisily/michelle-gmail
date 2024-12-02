import { logger } from '../../../utils/logger.js';
import { ConnectionState } from './types.js';
import { getCurrentTimestamp, isoToUnix } from '../utils/timeUtils.js';

export class ConnectionStateManager {
  constructor() {
    this.connections = new Map();
  }

  addConnection(ws, clientData) {
    if (ws.readyState <= ConnectionState.OPEN) {
      const now = Date.now();
      this.connections.set(ws, {
        ...clientData,
        pendingConfirmations: new Set(),
        lastActivity: now,
        lastMessage: now,
        connectedAt: now,
        lastPong: now
      });
      
      logger.debug('Client connection added', {
        clientId: clientData.id,
        conversationId: clientData.conversationId,
        readyState: ws.readyState,
        timestamp: getCurrentTimestamp()
      });
    }
  }

  removeConnection(ws) {
    const client = this.connections.get(ws);
    if (client) {
      logger.debug('Client connection removed', {
        clientId: client.id,
        conversationId: client.conversationId,
        timestamp: getCurrentTimestamp()
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

    return ws.readyState === ConnectionState.OPEN;
  }

  updateActivity(ws) {
    const connection = this.connections.get(ws);
    if (connection) {
      const now = Date.now();
      connection.lastActivity = now;
      connection.lastMessage = now;
      
      logger.debug('Updated client activity', {
        clientId: connection.id,
        timestamp: getCurrentTimestamp()
      });
    }
  }

  getConnectionInfo(ws) {
    return this.connections.get(ws);
  }

  getAllConnections() {
    return Array.from(this.connections.entries());
  }
}

export const connectionState = new ConnectionStateManager();