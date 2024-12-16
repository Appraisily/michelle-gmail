import { logger } from '../../../utils/logger.js';
import { ConnectionState } from './types.js';
import { activityTracker } from './activity.js';

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
        lastPong: now,
        isAlive: true
      });

      // Initialize activity tracking
      activityTracker.updateActivity(clientData.id, 'connect');
      
      logger.debug('Client connection added', {
        clientId: clientData.id,
        conversationId: clientData.conversationId,
        readyState: ws.readyState,
        timestamp: new Date(now).toISOString()
      });
    }
  }

  removeConnection(ws) {
    const client = this.connections.get(ws);
    if (client) {
      // Clean up activity tracking
      activityTracker.removeClient(client.id);
      
      logger.debug('Client connection removed', {
        clientId: client.id,
        conversationId: client.conversationId,
        timestamp: new Date().toISOString()
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

  updateActivity(ws, messageType) {
    const connection = this.connections.get(ws);
    if (connection) {
      // Update both connection state and activity tracker
      activityTracker.updateActivity(connection.id, messageType);
      connection.isAlive = true;
      
      logger.debug('Updated client activity', {
        clientId: connection.id,
        messageType,
        timestamp: new Date().toISOString()
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