import { logger } from '../../utils/logger.js';

export const HEARTBEAT_INTERVAL = 60000; // 60 seconds
export const HEARTBEAT_TIMEOUT = 70000; // 70 seconds (interval + 10s grace period)

/**
 * Sets up heartbeat monitoring for WebSocket connections
 * @param {WebSocketServer} wss - The WebSocket server instance
 * @param {Map} clients - Map of active client connections
 * @returns {NodeJS.Timer} The heartbeat interval
 */
export function setupHeartbeat(wss, clients) {
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      const client = clients.get(ws);
      
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
        
        clients.delete(ws);
        return ws.terminate();
      }

      // Mark as inactive until pong received
      client.isAlive = false;
      
      // Send ping (will trigger pong event if client is alive)
      ws.ping('', false, (err) => {
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

/**
 * Cleans up heartbeat interval
 * @param {NodeJS.Timer} interval - The heartbeat interval to clear
 */
export function cleanupHeartbeat(interval) {
  if (interval) {
    clearInterval(interval);
    logger.info('Heartbeat service stopped', {
      timestamp: new Date().toISOString()
    });
  }
}