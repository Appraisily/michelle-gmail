import { logger } from '../../utils/logger.js';

export const HEARTBEAT_INTERVAL = 30000; // 30 seconds
export const HEARTBEAT_TIMEOUT = 120000; // 120 seconds (increased from 90s)
export const INITIAL_GRACE_PERIOD = 45000; // 45 second initial grace period

/**
 * Sets up heartbeat monitoring for WebSocket connections
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

      // Give new connections an initial grace period
      if (Date.now() - client.connectedAt < INITIAL_GRACE_PERIOD) {
        client.isAlive = true; // Keep client alive during grace period
        return;
      }

      // Check last pong time
      const lastPongAge = Date.now() - (client.lastPong || 0);
      if (lastPongAge > HEARTBEAT_TIMEOUT) {
        logger.info('Client exceeded heartbeat timeout', {
          clientId: client.id,
          lastPongAge,
          timeout: HEARTBEAT_TIMEOUT,
          timestamp: new Date().toISOString()
        });
        connectionManager.removeConnection(ws);
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

  logger.info('Heartbeat service initialized', {
    interval: HEARTBEAT_INTERVAL,
    timeout: HEARTBEAT_TIMEOUT,
    initialGracePeriod: INITIAL_GRACE_PERIOD,
    timestamp: new Date().toISOString()
  });

  return interval;
}

/**
 * Handles pong response from client
 */
export function handlePong(ws, client) {
  if (client) {
    client.isAlive = true;
    client.lastPong = Date.now();
    client.lastMessage = Date.now(); // Update lastMessage on pong too
    
    logger.debug('Received pong from client', {
      clientId: client.id,
      conversationId: client.conversationId,
      timestamp: new Date().toISOString()
    });
  }
}