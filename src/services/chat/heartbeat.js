import { logger } from '../../utils/logger.js';

export const HEARTBEAT_INTERVAL = 60000; // 60 seconds

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
    timestamp: new Date().toISOString()
  });

  return interval;
}

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