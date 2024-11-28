import { logger } from '../../utils/logger.js';
import { ConnectionState } from './connection/types.js';

export const HEARTBEAT_INTERVAL = 10000; // 10 seconds
export const HEARTBEAT_TIMEOUT = 15000; // 15 seconds (interval + 5s grace period)

/**
 * Sets up heartbeat monitoring for WebSocket connections
 * @param {WebSocketServer} wss - The WebSocket server instance
 * @param {ConnectionManager} connectionManager - Connection manager instance
 * @returns {NodeJS.Timer} The heartbeat interval
 */
export function setupHeartbeat(wss, connectionManager) {
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      const client = connectionManager.getConnectionInfo(ws);
      
      // Clean up if no client data exists
      if (!client) {
        logger.warn('Client without data found, terminating', {
          timestamp: new Date().toISOString()
        });
        return ws.terminate();
      }

      // Check if client missed last heartbeat
      if (client.isAlive === false) {
        logger.info('Terminating inactive client', {
          clientId: client.id,
          conversationId: client.conversationId,
          lastMessage: new Date(client.lastMessage).toISOString(),
          inactiveTime: Date.now() - client.lastMessage
        });
        
        connectionManager.removeConnection(ws);
        return ws.terminate();
      }

      // Mark as inactive until pong received
      client.isAlive = false;
      
      // Send ping with the required format
      const pingMessage = JSON.stringify({
        type: 'ping',
        clientId: client.id,
        timestamp: new Date().toISOString()
      });
      
      ws.send(pingMessage, (err) => {
        if (err) {
          logger.error('Error sending ping', {
            error: err.message,
            clientId: client.id,
            stack: err.stack
          });
        }
      });
    });
  }, HEARTBEAT_INTERVAL);

  // Log heartbeat service start
  logger.info('Heartbeat service initialized', {
    interval: HEARTBEAT_INTERVAL,
    timeout: HEARTBEAT_TIMEOUT,
    timestamp: new Date().toISOString()
  });

  return interval;
}

/**
 * Handles pong response from client
 * @param {WebSocket} ws - The WebSocket connection
 * @param {Object} client - Client data object
 */
export function handlePong(ws, client) {
  if (client) {
    client.isAlive = true;
    client.lastPong = Date.now();
    
    logger.debug('Received pong from client', {
      clientId: client.id,
      conversationId: client.conversationId,
      timestamp: new Date().toISOString()
    });
  }
}